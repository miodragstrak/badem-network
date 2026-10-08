#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <solduino.h>

// ============================================================================
// Parameter configuration
// ============================================================================
const char* WIFI_SSID     = "Your Wi-Fi SSID";
const char* WIFI_PASSWORD = "Your Wi-Fi pass";

// IP address of the MKS DLC32 controller on the local network
const char* MKS_DLC32_IP  = "IP address of MKS DLC32"; 
const int   MKS_TELNET_PORT = 23; // Стандардни GRBL TCP/Telnet порт

// Solana RPC node (Devnet)
const char* SOLANA_RPC_URL = "https://api.devnet.solana.com";

// Machine wallet private key (Base58)
const char* MACHINE_PRIVATE_KEY_B58 = "Wallet private key";

// Public address of the award/contract recipient
const char* REWARD_RECIPIENT_PUBKEY = "Public key for recipient";

// ============================================================================
// Global objects
// ============================================================================
WiFiClient mksClient;          // Standard TCP client for MKS (Port 23)
RpcClient rpc(SOLANA_RPC_URL); // Solduino v2.0.0 RPC client
Keypair machineWallet;

enum MachineState {
    STATE_IDLE,
    STATE_RUNNING,
    STATE_COMPLETED
};

MachineState currentMachineState = STATE_IDLE;
unsigned long lastStatusQuery = 0;

// ============================================================================
// Function for creating and sending a Solana transaction !TODO - testing
// ============================================================================
// void sendProofOfWorkTransaction() {
//     Serial.println("\n[BLOCKCHAIN] Starting to generate the Proof-of-Work....");

//     // 1. Downloading the latest blockhash
//     String recentBlockhash = rpc.getLatestBlockhash();
//     if (recentBlockhash.length() == 0) {
//         recentBlockhash = rpc.getRecentBlockhash();
//     }

//     if (recentBlockhash.length() == 0) {
//         Serial.println(F("[ERROR] Failed to fetch recentBlockhash from the RPC!"));
//         return;
//     }
//     Serial.print(F("[BLOCKCHAIN] Latest Blockhash: "));
//     Serial.println(recentBlockhash);

//     // 2. Creating a Solana transaction
//     Transaction tx;
//     tx.setRecentBlockhash(recentBlockhash.c_str());
//     tx.setFeePayer(machineWallet.getPublicKey());

//     // 3. Adding an instruction (Reward 0.001 SOL)
//     uint64_t lamports = 1000000; 
//     Instruction transferInstruction = SystemProgram::transfer(
//         machineWallet.getPublicKey(),
//         PublicKey(REWARD_RECIPIENT_PUBKEY),
//         lamports
//     );
//     tx.addInstruction(transferInstruction);

//     // 4. Local transaction signing
//     tx.sign(machineWallet);

//     // 5. Base64 serialization
//     char txBase64[2048];
//     if (TransactionSerializer::encodeTransaction(tx, txBase64, sizeof(txBase64))) {
//         Serial.println(F("[BLOCKCHAIN] Transaction successfully signed and serialized."));
        
//         // 6. Слање на Solana мрежу
//         String txSignature = rpc.sendTransaction(String(txBase64));
        
//         if (txSignature.length() > 0) {
//             Serial.print(F("[SUCCESS] The transaction has been recorded on the blockchain! Signature (TX Hash): "));
//             Serial.println(txSignature);
//         } else {
//             Serial.println(F("[ERROR] The blockchain rejected the transaction."));
//         }
//     } else {
//         Serial.println(F("[ERROR] Error during transaction serialization!"));
//     }
// }

// ============================================================================
// Setup initialization
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println(F("\n=== DePIN Solana ESP32 Node Initializing (Port 23 Telnet) ==="));

    // 1. Connecting to a Wi-Fi network
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to a Wi-Fi network");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.print("\n[Wi-Fi] Connected! IP address: ");
    Serial.println(WiFi.localIP());

    // 2. Loading Solana wallet
    if (machineWallet.importFromPrivateKeyBase58(MACHINE_PRIVATE_KEY_B58)) {
        Serial.println(F("[SOLANA WALLET] Private key successfully loaded!"));
    } else {
        Serial.println(F("[CRITICAL ERROR] Invalid private key for Solana wallet!"));
        while(1) { delay(1000); }
    }
    
    char pubKeyAddr[64];
    machineWallet.getPublicKeyAddress(pubKeyAddr, sizeof(pubKeyAddr));
    Serial.print(F("[SOLANA WALLET] On-chain machine address: "));
    Serial.println(pubKeyAddr);
}

// ============================================================================
// Main Loop
// ============================================================================
void loop() {
    // 1. Maintaining a TCP connection with the MKS DLC32 on Port 23
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

    // 2. Reading incoming data from the MKS DLC32 board
    while (mksClient.available()) {
        String line = mksClient.readStringUntil('\n');
        line.trim();

        if (line.length() > 0) {
            // Printing the raw GRBL response.
            Serial.print("[MKS GRBL] ");
            Serial.println(line);

            // Анализа статуса
            if (line.indexOf("Run") != -1 || line.indexOf("Hold") != -1) {
                if (currentMachineState != STATE_RUNNING) {
                    Serial.println("\n==========================================");
                    Serial.println(">>> DETECTED: MACHINE RUNS <<<");
                    Serial.println("==========================================\n");
                    currentMachineState = STATE_RUNNING;
                }
            } 
            else if (line.indexOf("Idle") != -1) {
                if (currentMachineState == STATE_RUNNING) {
                    Serial.println("\n==================================================");
                    Serial.println(">>> JOB COMPLETED! (RUN -> IDLE) <<<");
                    Serial.println(">>> INITIATING TRANSACTION WRITE TO SOLANA... <<<");
                    Serial.println("==================================================\n");
                    
                    currentMachineState = STATE_COMPLETED;
                    
                    // Solana transaction call
                    //sendProofOfWorkTransaction();
                    
                    currentMachineState = STATE_IDLE;
                } else {
                    currentMachineState = STATE_IDLE;
                }
            }
        }
    }

    // 3. Periodic sending of '?' queries every 500 ms
    if (millis() - lastStatusQuery >= 500) {
        lastStatusQuery = millis();
        // Sending the simple character '?' to port 23 directly returns the status from GRBL.
        mksClient.print("?");
    }
}
