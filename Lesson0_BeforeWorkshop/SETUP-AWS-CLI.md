# Installing AWS-CLI

If not already installed, easiest way to get it is via NPM [AWS-CLI on NPM](https://www.npmjs.com/package/aws-cli).
The AWS-CLI is a tremendously capable tool with which to interface with all the AWS services, but is beyond the scope of this project.

Having set up your `~/.aws/credentials` file for Serverless.com, the AWS-CLI will use that same identity file.
Use the `AWS_PROFILE` environment variable to select the profile to use when calling the AWS managed services.

The AWS-CLI may also be used to configure the user's credentials stored in the `~/.aws/credentials` file, using the following command:

```
aws configure
```

When prompted, enter your AWS *Access Key ID* and your *Secret Access Key* then your optional default region and output format. Once done, that information should persisted under
 the default profile and will be used for all AWS-CLI or Serverless.com commands.