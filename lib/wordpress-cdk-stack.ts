import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Duration, RemovalPolicy, SecretValue, StackProps } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize, InstanceType, Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ContainerImage, FargateTaskDefinition, LogDrivers } from 'aws-cdk-lib/aws-ecs';
import { FileSystem } from 'aws-cdk-lib/aws-efs';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { DatabaseInstance, DatabaseInstanceEngine, MysqlEngineVersion } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';

export interface WordpressCdkStackProps extends StackProps {
  certificateArn: string;
  hostedZoneId: string;
  hostedZoneName: string;
  aRecordName: string;
}

export class WordpressCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WordpressCdkStackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'WordpressVpc');

    const cluster = new Cluster(this, 'WordpressCluster', { vpc });

    const dbCredentials = new Secret(this, 'WordpressDbCredentials', {
      generateSecretString: {
        passwordLength: 30,
        excludePunctuation: true,
        includeSpace: false
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretAuthKey = new Secret(this, 'WpAuthKey', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretSecureAuthKey = new Secret(this, 'WpSecureAuthKey', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretLoggedInKey = new Secret(this, 'WpLoggedInKey', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretNonceKey = new Secret(this, 'WpNonceKey', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretAuthSalt = new Secret(this, 'WpAuthSalt', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretSecureAuthSalt = new Secret(this, 'WpSecureAuthSalt', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretLoggedInSalt = new Secret(this, 'WpLoggedInSalt', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const secretNonceSalt = new Secret(this, 'WpNonceSalt', {
      generateSecretString: {
        excludeCharacters: '\'"',
        passwordLength: 64
      },
      removalPolicy: RemovalPolicy.DESTROY
    });

    const dbSecurityGroup = new SecurityGroup(this, 'WordpressRdsSecurityGroup', {
      vpc,
      description: 'Allow MySql Connection',
    });
    dbSecurityGroup.addIngressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(3306), 'Allow MySQL connection'); 

    const db = new DatabaseInstance(this, 'WordpressMysqlRdsInstance', {
      credentials: {
        username: 'admin',
        password: dbCredentials.secretValue
      },
      vpc: vpc,
      port: 3306,
      databaseName: 'wordpress',
      allocatedStorage: 20,
      instanceIdentifier: 'mysql-wordpress',
      engine: DatabaseInstanceEngine.mysql({
        version: MysqlEngineVersion.VER_8_0
      }),
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      securityGroups: [dbSecurityGroup]
    });

    const fsSecurityGroup = new SecurityGroup(this, 'WordpressEfsSecurityGroup', {
      vpc,
      description: 'Allow access to efs',
    });
    fsSecurityGroup.addIngressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(2049), 'Allow access to the EFS file mounts')

    const fileSystem = new FileSystem(this, 'WordpressContent', {
      vpc,
      encrypted: true,
      securityGroup: fsSecurityGroup,
      removalPolicy: RemovalPolicy.DESTROY 
    });

    const taskExecutionRole = new Role(this, 'WordpressTaskExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    taskExecutionRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    dbCredentials.grantRead(taskExecutionRole);
    secretAuthKey.grantRead(taskExecutionRole);
    secretSecureAuthKey.grantRead(taskExecutionRole);
    secretLoggedInKey.grantRead(taskExecutionRole);
    secretNonceKey.grantRead(taskExecutionRole);
    secretAuthSalt.grantRead(taskExecutionRole);
    secretSecureAuthSalt.grantRead(taskExecutionRole);
    secretLoggedInSalt.grantRead(taskExecutionRole);
    secretNonceSalt.grantRead(taskExecutionRole);

    const taskSecurityGroup = new SecurityGroup(this, 'WordpressTaskSecurityGroup', {
      vpc,
      description: 'Allow access to the task',
    });

    const taskDefinition = new FargateTaskDefinition(this, 'WordpressTaskDefinition', {
      family: 'wordpress',
      executionRole: taskExecutionRole,
      memoryLimitMiB: 512,
      cpu: 256,
      volumes: [{
        name: 'wp-content',
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          transitEncryption: 'ENABLED'
        }
      }]
    });

    const container = taskDefinition.addContainer('Wordpress', {
      image: ContainerImage.fromRegistry('wordpress:6.2-apache'),
      logging: LogDrivers.awsLogs({ streamPrefix: 'Wordpress' }),
      memoryLimitMiB: 512,
      cpu: 256,
      environment: {
        WORDPRESS_DB_HOST: `${db.dbInstanceEndpointAddress}:${db.dbInstanceEndpointPort}`,
        WORDPRESS_DB_NAME: 'wordpress',
        WORDPRESS_DB_USER: 'admin'
      },
      secrets: {
        WORDPRESS_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials),
        WORDPRESS_AUTH_KEY: ecs.Secret.fromSecretsManager(secretAuthKey),
        WORDPRESS_SECURE_AUTH_KEY: ecs.Secret.fromSecretsManager(secretSecureAuthKey),
        WORDPRESS_LOGGED_IN_KEY: ecs.Secret.fromSecretsManager(secretLoggedInKey),
        WORDPRESS_NONCE_KEY: ecs.Secret.fromSecretsManager(secretNonceKey),
        WORDPRESS_AUTH_SALT: ecs.Secret.fromSecretsManager(secretAuthSalt),
        WORDPRESS_SECURE_AUTH_SALT: ecs.Secret.fromSecretsManager(secretSecureAuthSalt),
        WORDPRESS_LOGGED_IN_SALT: ecs.Secret.fromSecretsManager(secretLoggedInSalt),
        WORDPRESS_NONCE_SALT: ecs.Secret.fromSecretsManager(secretNonceSalt)
      }
    });
    
    container.addPortMappings({
      containerPort: 80
    });

    container.addMountPoints({
      sourceVolume: 'wp-content',
      containerPath: '/var/www/html/wp-content',
      readOnly: false
    });

    const certificate = Certificate.fromCertificateArn(this, 'WordpressDomainCertificate', props.certificateArn);

    const wordpress = new ApplicationLoadBalancedFargateService(this, 'WordpressService', {
      cluster,
      taskDefinition,
      certificate,
      redirectHTTP: true
    });

    wordpress.service.connections.addSecurityGroup(taskSecurityGroup);

    wordpress.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 1
    });

    wordpress.targetGroup.configureHealthCheck({
      enabled: true,
      path: '/index.php',
      healthyHttpCodes: '200,201,301,302',
      interval: Duration.seconds(15),
      timeout: Duration.seconds(10),
      healthyThresholdCount: 3,
      unhealthyThresholdCount: 2
    });

    const publicZone = HostedZone.fromHostedZoneAttributes(this, 'WordpressHostedZone', {
      zoneName: props.hostedZoneName,
      hostedZoneId: props.hostedZoneId,
    });

    const aRecord = new ARecord(this, 'WordpressARecord', {
      zone: publicZone,
      recordName: props.aRecordName,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(wordpress.loadBalancer)),
    });

    const wwwARecord = new ARecord(this, 'WordpressWWWARecord', {
      zone: publicZone,
      recordName: `www.${props.aRecordName}`,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(wordpress.loadBalancer))
    });
  }
}
