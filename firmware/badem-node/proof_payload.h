#pragma once

#include <ArduinoJson.h>
#include <keypair.h>
#include <sodium.h>
#include <stdint.h>
#include <string>

namespace badem {

struct CompletionProof {
    std::string canonical;
    std::string json;
};

inline std::string hexBytes(const uint8_t* bytes, size_t length) {
    const char* digits = "0123456789abcdef";
    std::string encoded(length * 2, '0');
    for (size_t index = 0; index < length; ++index) {
        encoded[index * 2] = digits[bytes[index] >> 4];
        encoded[index * 2 + 1] = digits[bytes[index] & 15];
    }
    return encoded;
}

inline bool validIdentifier(const char* identifier, size_t maxLength) {
    if (!identifier || !identifier[0]) return false;
    for (size_t index = 0; identifier[index]; ++index) {
        const char value = identifier[index];
        const bool alphanumeric = (value >= 'A' && value <= 'Z') ||
            (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9');
        if (index >= maxLength || (!alphanumeric && (index == 0 ||
                (value != '.' && value != '_' && value != ':' && value != '-')))) return false;
    }
    return true;
}

inline bool buildCompletionProof(const Keypair& wallet, const char* nodeId,
        const char* jobId, int64_t timestamp, CompletionProof& proof) {
    proof = CompletionProof{};
    if (!validIdentifier(nodeId, 80) || !validIdentifier(jobId, 100) || timestamp < 0) return false;
    if (!wallet.isInitialized() || sodium_init() < 0) return false;

    const std::string metadata = std::string(nodeId) + "|" + jobId +
        "|COMPLETED|" + std::to_string(timestamp);
    uint8_t digest[crypto_hash_sha256_BYTES];
    if (crypto_hash_sha256(digest, reinterpret_cast<const uint8_t*>(metadata.data()),
            metadata.size()) != 0) return false;
    const std::string proofHash = hexBytes(digest, sizeof(digest));
    proof.canonical = metadata + "|" + proofHash;

    uint8_t publicKey[32];
    uint8_t signature[64];
    const auto* message = reinterpret_cast<const uint8_t*>(proof.canonical.data());
    if (!wallet.getPublicKey(publicKey) ||
            !wallet.sign(message, proof.canonical.size(), signature) ||
            !wallet.verify(message, proof.canonical.size(), signature)) return false;

    const std::string publicKeyHex = hexBytes(publicKey, sizeof(publicKey));
    const std::string signatureHex = hexBytes(signature, sizeof(signature));
    StaticJsonDocument<768> document;
    document["node_id"] = nodeId;
    document["job_id"] = jobId;
    document["event"] = "COMPLETED";
    document["timestamp"] = timestamp;
    document["proof_hash"] = proofHash.c_str();
    document["public_key"] = publicKeyHex.c_str();
    document["signature"] = signatureHex.c_str();
    if (document.overflowed()) return false;
    serializeJson(document, proof.json);
    return !proof.json.empty();
}

}  // namespace badem
