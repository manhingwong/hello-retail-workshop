#!/usr/bin/env bash

if which aws > /dev/null
    then
        echo "AWS CLI found."
    else
        echo "Installing AWS CLI"

        if ! [ -f awscli-bundle.zip ]
            then
                curl "https://s3.amazonaws.com/aws-cli/awscli-bundle.zip" -o "awscli-bundle.zip"
        fi

        unzip -n awscli-bundle.zip
        sudo ./awscli-bundle/install -i /usr/local/aws -b /usr/local/bin/aws

        echo "Install complete; cleaning up bundle files."
        rm -r ./awscli-bundle
        rm ./awscli-bundle.zip
fi
