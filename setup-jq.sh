#!/usr/bin/env bash

function install_homebrew {
    if which brew > /dev/null
        then
            echo "Brew found. Making sure it's up to date..."
            brew update
        else
            echo "Installing brew ..."
            /usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
    fi
}

if which jq > /dev/null
    then
        echo "jq is installed."
    else
        install_homebrew
        brew install jq
fi
