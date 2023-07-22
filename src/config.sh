#!/bin/bash -xe

# Update with optional user data that will run on instance start.
# Learn more about user-data: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html

sudo yum install -y httpd
sudo service httpd start

wget https://wordpress.org/latest.tar.gz
tar -xzf latest.tar.gz
cd wordpress
cp wp-config-sample.php wp-config.php

sudo amazon-linux-extras install -y lamp-mariadb10.2-php7.2 php7.2
cd /home/ec2-user
sudo cp -r wordpress/* /var/www/html/
sudo service httpd restart
