#include <iostream>
#include "proof_payload.h"

int main(int argc, char** argv) {
    if (argc != 4) return 1;
    std::string walletSecret;
    std::cin >> walletSecret;
    Keypair wallet;
    if (!wallet.importFromPrivateKeyBase58(walletSecret.c_str())) return 1;
    sodium_memzero(&walletSecret[0], walletSecret.size());
    badem::CompletionProof proof;
    if (!badem::buildCompletionProof(wallet, argv[1], argv[2], std::stoll(argv[3]), proof)) return 2;
    std::cout << proof.canonical << '\n' << proof.json << '\n';
    return 0;
}
