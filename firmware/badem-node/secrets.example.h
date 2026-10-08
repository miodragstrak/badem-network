#pragma once

// Copy to ignored secrets.h and use a local test wallet, never production keys.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define MKS_DLC32_IP "192.168.1.50"
#define MACHINE_PRIVATE_KEY_B58 ""

#define NODE_ID "BADEM-001"
#define JOB_ID "JOB-0042"
#define BADEM_API_URL "http://192.168.1.100:8000"
#define NTP_SERVER "pool.ntp.org"

// Required for HTTPS: trusted server root CA PEM, never disable verification.
#define BADEM_API_CA_CERT ""
