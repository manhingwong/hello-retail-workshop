#Lesson 0: Before the workshop
Goal: Install everything needed for the workshop and confirm that you can login to a public cloud v2 account.

###Step 0: Slack!
Setup nordstrom.slack.com and subscribe to the #serverless-discuss channel, this is where you'll be able to ask and help answer questions.

###Step 1: Install node.js
Ensure that you have [Node.js](https://nodejs.org/en/) (v4 or better) installed.

###Step 2: Ensure that you have access to an AWS Account.
If you are a Nordstrom engineer, you may want to use a Nordstrom Public Cloud V2 account.
Nordstrom Public Cloud V2 is a substantial improvement to Pub Cloud V1.  It gives you far greater access and control to all of the things.  This workshop will not work on a public cloud v1 account.  If you are not a Nordstrom engineer and you're reading this a generic AWS account will work just fine.  If you're at a company that limits your ability to create roles/buckets/API Gateways your mileage will vary.

####Option 1: Your team already has a public cloud v2 account
You will see a completely separate login account for just your feature team when you select a login from the federated login page.

####Option 2: Log in to the public cloud team's public cloud v2 sandbox account. (If you signed up for the workshop you should have access, if not ask for hel on the #serverless-discuss slack channel.
Every workshop participant that registered on the confluence page should have access to the sanboxteam01 AWS account through your federated account login.

####Option 3: Use your own personal AWS account
This should cost less than $10, just remember to delete all resources when you're done.

###Step 3: serverless deployments require AWS credentials

####Option 1:
Go to AWS IAM console --> users --> select your user ID --> security credentials tab
Select: Create Access Key
Download credentials csv file

```sh
<editor of choice> ~/.aws/credentials
```

Add to the credentials file:
```sh
[my-profile]
aws_access_key_id=<your access key ID from the credentials csv>
aws_secret_access_key=<your secret access key from the credentials csv>
```

From your terminal:
```sh
$ export AWS_PROFILE=my-profile
```

####Option 2:
You may already have these credentials on your machine using the AWS SDK, aws init, or some corporate utility.

```sh
$ export AWS_PROFILE=your-preexisting-profile
```

####Option 3:
Grab your credentials from a script, tool, or whatevs and add them to the environment.

```sh
$ export AWS_ACCESS_KEY_ID=<access-key-id>
$ export AWS_SECRET_ACCESS_KEY=<secret-access-key>
$ export AWS_SESSION_TOKEN=<session-token>             # this one is optional
```
###Step 4: serverless deployments require some information you may not want to check in to a public repo.  Fill in the information in private.yml.

###Step 5: install serverless v1.6 node package on your machine.  *For the moment, there are some issues with the latest Serverless package.  See* https://github.com/serverless/serverless/issues/3253.

####Note: if you are on a VPN and use a proxy, export your proxy to your shell
```sh
export proxy=https://your.proxy.com:1234
```

Regardless, install the serverless.com deployment framework - this will make it easy to deploy serverless components to AWS
```sh
# $ sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
# Uncomment the above if you have corrupted your file system and are on MacOSX.
$ npm install -g serverless@1.6.0
```

###Step 6: clone the repo on your local machine

Go to https://github.com/Nordstrom/hello-retail-workshop and fork our Repo, then clone it locally.

From your workshop directory:
```sh
$ git clone https://github.com/Nordstrom/hello-retail-workshop.git
```
For more information on using github, go to https://help.github.com/articles/fork-a-repo/