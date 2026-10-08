#pragma once

#include <stddef.h>
#include <stdint.h>

// Host-only platform shims; cryptography is the real Solduino/libsodium code.
class String {
public:
    const char* c_str() const { return ""; }
    size_t length() const { return 0; }
};

struct SerialStub {
    template <typename T> void print(const T&, int = 10) {}
    template <typename T> void println(const T&) {}
    void println() {}
};

static SerialStub Serial;
#define HEX 16
