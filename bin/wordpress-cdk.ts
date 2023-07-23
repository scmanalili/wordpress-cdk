#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WordpressCdkStack } from '../lib/wordpress-cdk-stack';

const app = new cdk.App();
new WordpressCdkStack(app, 'WordpressCdkStack', {
    aRecordName: '',
    certificateArn: '',
    hostedZoneId: '',
    hostedZoneName: ''
});