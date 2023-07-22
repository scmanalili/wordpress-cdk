import * as cdk from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { AmazonLinuxCpuType, AmazonLinuxGeneration, AmazonLinuxImage, CfnKeyPair, Instance, InstanceClass, InstanceSize, InstanceType, Peer, Port, SecurityGroup, Subnet, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion } from 'aws-cdk-lib/aws-rds';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import path = require('path');

export class WordpressCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'WordpressVpc', {
      natGateways: 0,
      subnetConfiguration:
        [
          {
            cidrMask: 24,
            name: 'ec2',
            subnetType: SubnetType.PUBLIC
          },
          {
            cidrMask: 28,
            name: 'rds',
            subnetType: SubnetType.PRIVATE_ISOLATED
          }
        ]
    });

    const ec2SecurityGroup = new SecurityGroup(this, 'WordpressSecurityGroup', {
      vpc,
      description: 'Allow SSH (TCP port 22) in',
      allowAllOutbound: true
    });
    ec2SecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'Allow SSH access');

    const role = new Role(this, 'ec2Role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    });
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    const ami = new AmazonLinuxImage({
      generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      cpuType: AmazonLinuxCpuType.X86_64
    });

    const key = new CfnKeyPair(this, 'WordpressEc2KeyPair', {
      keyName: 'wordpress-ec2-keypair',
      keyFormat: 'pem'
    });

    const ec2Instance = new Instance(this, 'WordpressInstance', {
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC
      },
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: ec2SecurityGroup,
      keyName: key.keyName,
      role
    });

    const asset = new Asset(this, 'WordpressAsset', { path: path.join(__dirname, '../src/config.sh') });
    const localPath = ec2Instance.userData.addS3DownloadCommand({
      bucket: asset.bucket,
      bucketKey: asset.s3ObjectKey
    });

    ec2Instance.userData.addExecuteFileCommand({
      filePath: localPath,
      arguments: '--verbose -y',
    });
    asset.grantRead(ec2Instance.role);

    const instanceIdentifier = 'mysql-wordpress';
    const credsSecretName = `/${id}/rds/creds/${instanceIdentifier}`.toLowerCase();
    const creds = new DatabaseSecret(this, 'WordpressMysqlRdsCredentials', {
      secretName: credsSecretName,
      username: 'wordpress'
    });

    const dbSecurityGroup = new SecurityGroup(this, 'WordpressRdsSecurityGroup', {
      vpc,
      description: 'Allow MySql Connection',
      allowAllOutbound: true
    });
    dbSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(3306), 'Allow MySQL connection');

    const dbServer = new DatabaseInstance(this, 'WordpressMysqlRdsInstance', {
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED
      },
      credentials: Credentials.fromSecret(creds),
      vpc: vpc,
      port: 3306,
      databaseName: 'wordpress',
      allocatedStorage: 20,
      instanceIdentifier,
      engine: DatabaseInstanceEngine.mysql({
        version: MysqlEngineVersion.VER_8_0
      }),
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      securityGroups: [dbSecurityGroup]
    });

    new CfnOutput(this, 'IP Address', { value: ec2Instance.instancePublicIp });
    new CfnOutput(this, 'Download Key Command', { value: `aws ssm get-parameter --name /ec2/keypair/${key.attrKeyPairId} --query Parameter.Value --with-decryption --output text > cdk-key.pem` });
    new CfnOutput(this, 'SSH command', { value: 'ssh -i cdk-key.pem -o IdentitiesOnly=yes ec2-user@' + ec2Instance.instancePublicIp });
  }
}
