#!/bin/bash

# Install the app on macOS

source ./utils-darwin.sh

build_electric
git_clone_third_parties
install_postgres
install_ollama
install_onnxruntime
