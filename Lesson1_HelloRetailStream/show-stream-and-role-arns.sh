#!/usr/bin/env bash
aws iam list-roles | grep Arn | grep $STAGE | sed -n "s/^.*\(arn\:aws\:iam\:\:[0-9]*\:role\/.*StreamWriter\).*/\1/p"
aws kinesis describe-stream --stream-name `aws kinesis list-streams | sed -n "s/^.*\"\(.*\)\".*/\1/p" | grep ${STAGE}Stream` | grep StreamARN | sed -n "s/^.*\(arn\:aws\:kinesis\:.*Stream\).*/\1/p"
