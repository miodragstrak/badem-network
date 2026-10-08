#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <time.h>
#include "proof_payload.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#define BADEM_USING_EXAMPLE_SECRETS
#endif

#ifndef NODE_ID
#define NODE_ID "BADEM-001"
#endif
#ifndef JOB_ID
#define JOB_ID "JOB-0042"
#endif
#ifndef BADEM_API_URL
#define BADEM_API_URL "http://192.168.1.100:8000"
#endif
#ifndef NTP_SERVER
#define NTP_SERVER "pool.ntp.org"
#endif
#ifndef BADEM_API_CA_CERT
#define BADEM_API_CA_CERT ""
#endif

const int MKS_TELNET_PORT = 23;
WiFiClient mksClient;
Keypair machineWallet;
QueueHandle_t completionQueue = nullptr;

enum MachineState {
    STATE_IDLE,
    STATE_RUNNING,
    STATE_COMPLETED
};

MachineState currentMachineState = STATE_IDLE;
unsigned long lastStatusQuery = 0;

void postCompletionProof(int64_t timestamp) {
    badem::CompletionProof proof;
    if (!badem::buildCompletionProof(machineWallet, NODE_ID, JOB_ID, timestamp, proof)) {
        Serial.println(F("[PROOF] FAILURE: invalid identity or Ed25519 proof generation failed."));
        return;
    }
    Serial.print(F("[PROOF] Canonical message: "));
    Serial.println(proof.canonical.c_str());
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println(F("[PROOF] FAILURE: Wi-Fi unavailable; proof not posted."));
        return;
    }

    String endpoint = BADEM_API_URL;
    while (endpoint.endsWith("/")) endpoint.remove(endpoint.length() - 1);
    endpoint += "/api/proofs";
    HTTPClient http;
    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    bool started = false;
    if (endpoint.startsWith("https://")) {
        if (!BADEM_API_CA_CERT[0]) {
            Serial.println(F("[PROOF] FAILURE: HTTPS requires a trusted BADEM_API_CA_CERT."));
            return;
        }
        secureClient.setCACert(BADEM_API_CA_CERT);
        started = http.begin(secureClient, endpoint);
    } else if (endpoint.startsWith("http://")) {
        started = http.begin(plainClient, endpoint);
    }
    if (!started) {
        Serial.println(F("[PROOF] FAILURE: invalid BADEM_API_URL or HTTP initialization failed."));
        return;
    }
    http.setConnectTimeout(5000);
    http.setTimeout(5000);
    http.addHeader("Content-Type", "application/json");
    Serial.println(F("[PROOF] POST /api/proofs"));
    const int status = http.POST(String(proof.json.c_str()));
    Serial.printf("[PROOF] HTTP status code: %d\n", status);
    if (status == 201) {
        StaticJsonDocument<512> response;
        const auto error = deserializeJson(response, http.getString());
        if (!error && response["status"] == "PROOF_RECEIVED" &&
                response["signature_verified"] == true && response["job_id"] == JOB_ID &&
                response["node_id"] == NODE_ID) {
            Serial.println(F("[PROOF] SUCCESS: device proof received; no Solana or buyer confirmation."));
        } else {
            Serial.println(F("[PROOF] FAILURE: unexpected response; acceptance not confirmed."));
        }
    } else if (status == 409) {
        Serial.println(F("[PROOF] FAILURE: duplicate proof or incompatible job state (409)."));
    } else {
        Serial.println(F("[PROOF] FAILURE: transport error or backend rejection; no automatic retry."));
    }
    http.end();
}

void proofWorker(void*) {
    int64_t timestamp;
    while (true) {
        if (xQueueReceive(completionQueue, &timestamp, portMAX_DELAY) == pdTRUE) {
            postCompletionProof(timestamp);
        }
    }
}

void queueCompletionProof() {
    const int64_t timestamp = static_cast<int64_t>(time(nullptr));
    if (timestamp < 1700000000) {
        Serial.println(F("[PROOF] FAILURE: UTC clock not synchronized; completion not queued."));
        return;
    }
    if (!completionQueue || xQueueSend(completionQueue, &timestamp, 0) != pdTRUE) {
        Serial.println(F("[PROOF] FAILURE: proof worker unavailable or RAM queue full."));
        return;
    }
    Serial.println(F("[PROOF] Completion queued for outbound delivery."));
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println(F("\n=== ESP32 BADEM Node: outbound signed completion proofs ==="));
#ifdef BADEM_USING_EXAMPLE_SECRETS
    Serial.println(F("[CONFIG] secrets.h missing; example placeholders cannot run the hardware demo."));
#endif
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print(F("Connecting to a Wi-Fi network"));
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.print(F("\n[Wi-Fi] Connected! IP address: "));
    Serial.println(WiFi.localIP());
    configTime(0, 0, NTP_SERVER);

    if (!machineWallet.importFromPrivateKeyBase58(MACHINE_PRIVATE_KEY_B58)) {
        Serial.println(F("[CRITICAL ERROR] Invalid local machine wallet; proof signing disabled."));
        while (true) delay(1000);
    }
    uint8_t publicKey[32];
    if (!machineWallet.getPublicKey(publicKey)) {
        Serial.println(F("[CRITICAL ERROR] Cannot read wallet public key."));
        while (true) delay(1000);
    }
    Serial.print(F("[NODE] Public key hex (register with backend): "));
    Serial.println(badem::hexBytes(publicKey, sizeof(publicKey)).c_str());
    completionQueue = xQueueCreate(4, sizeof(int64_t));
    if (!completionQueue || xTaskCreate(proofWorker, "badem-proof", 8192, nullptr, 1, nullptr) != pdPASS) {
        Serial.println(F("[PROOF] FAILURE: cannot start proof worker."));
        if (completionQueue) vQueueDelete(completionQueue);
        completionQueue = nullptr;
    }
}

void loop() {
    if (!mksClient.connected()) {
        static unsigned long lastReconnectAttempt = 0;
        if (millis() - lastReconnectAttempt > 3000) {
            lastReconnectAttempt = millis();
            Serial.print("[MKS TELNET] Attempting to connect to ");
            Serial.print(MKS_DLC32_IP);
            Serial.println(":23 ...");
            if (mksClient.connect(MKS_DLC32_IP, MKS_TELNET_PORT)) {
                Serial.println("[MKS TELNET] Connected to MKS DLC32 via Port 23!");
            } else {
                Serial.println("[MKS TELNET] Connection failed. Retrying in 3 seconds...");
            }
        }
        return;
    }

    while (mksClient.available()) {
        String line = mksClient.readStringUntil('\n');
        line.trim();
        if (line.length() > 0) {
            Serial.print("[MKS GRBL] ");
            Serial.println(line);
            if (line.indexOf("Run") != -1 || line.indexOf("Hold") != -1) {
                if (currentMachineState != STATE_RUNNING) {
                    Serial.println(">>> DETECTED: MACHINE RUNS <<<");
                    currentMachineState = STATE_RUNNING;
                }
            } else if (line.indexOf("Idle") != -1) {
                if (currentMachineState == STATE_RUNNING) {
                    Serial.println(">>> JOB COMPLETED! (RUN -> IDLE) <<<");
                    currentMachineState = STATE_COMPLETED;
                    queueCompletionProof();
                    currentMachineState = STATE_IDLE;
                } else {
                    currentMachineState = STATE_IDLE;
                }
            }
        }
    }

    if (millis() - lastStatusQuery >= 500) {
        lastStatusQuery = millis();
        mksClient.print("?");
    }
}
