#!/bin/bash

# Install the app on Linux

source ./utils-linux.sh

build_electric
git_clone_third_parties
install_postgres
install_ollama
install_onnxruntime
