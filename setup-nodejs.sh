#!/usr/bin/env bash

function open_node_download {
    echo "Dohttps://nodejs.org/en/download/"
    echo "Attempting to open Node JS download page ... "
    sleep 3
    open "https://nodejs.org/en/download/"
    exit 1
}

if which node > /dev/null
    then
        echo "Node JS found, version: $(node -v)"
    else
        echo "Node JS missing."
        open_node_download
        exit 1
fi

NODE_MAJOR_VERSION=`node -v | sed -n "s/^v\([0-9]\).*/\1/p"`

if [ $NODE_MAJOR_VERSION -lt 4 ]
    then
        echo "Node JS version $(node -v) is not sufficient. Please upgrade."
        open_node_download
        exit 1
fi

echo
echo "Installing NPM dependencies ..."

pushd Lesson2_CreateViewWithEventConsumer/winner-view
npm install

pushd Lesson3_PublicEndpointToAccessView/winner-api
npm install
