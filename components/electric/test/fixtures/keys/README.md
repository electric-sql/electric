Fixture Keys
============

This directory contains cryptographic key pairs that are used in jwt auth tests.

**DO NOT** use these keys anywhere else outside of Electric's test suite.

# Recipes

## RSA

One RSA key pair can be used for all `RS*` signing algorithms, namely, `RS256`, `RS384`, and `RS512`. It can be created
as follows:

```
$ openssl genrsa -out rsa.pem 4096
$ openssl rsa -in rsa.pem -pubout -out rsa_pub.pem
```

## ECC

For `ES*` signing algorithms, a different elliptic curve has to be used to create a key pair for every individual
variation. Here's how the `ecc*.pem` keys in this directory have been created.

### `ES256`

```
$ openssl ecparam -name prime256v1 -genkey -noout -out ecc256.pem
$ openssl ec -in ecc256.pem -pubout -out ecc256_pub.pem
```

### `ES384`

```
$ openssl ecparam -name secp384r1 -genkey -noout -out ecc384.pem
$ openssl ec -in ecc384.pem -pubout -out ecc384_pub.pem
```

### `ES512`

```
$ openssl ecparam -name secp521r1 -genkey -noout -out ecc512.pem
$ openssl ec -in ecc512.pem -pubout -out ecc512_pub.pem
```
