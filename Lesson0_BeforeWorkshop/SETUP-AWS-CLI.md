# Installing AWS CLI

If not already installed, we have provided a script in the workshop project root:

```sh
./setup-aws-cli.js
```

Otherwise, please follow the [guidance from AWS to install the CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html).

## Configuring Credentials

The AWS CLI may be used to configure the user's credentials stored in the `~/.aws/credentials` file, using the following command:

```
aws configure
```

When prompted, enter your AWS `Access Key ID` and your `Secret Access Key` then your optional default region and output format. Once done, that information should persisted under
 the default profile and will be used for all AWS-CLI or Serverless.com commands.

## Select Credentials Profile to Use

Serverless and the AWS CLI can share the credentials stored in `~/.aws/credentials` file.
 Use the `AWS_PROFILE` environment variable to select the profile to use when calling the AWS managed services.

```
export AWS_PROFILE=<profile name from credentials file>
```

*NOTE: The profile named `[default]` in your credentials file will be used if `AWS_PROFILE` is not set.*