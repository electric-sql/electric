---
title: Amazon ECS
description: >-
  The largest and the most popular cloud infrastructure provider.
sidebar_position: 56
icon: /img/deployment/aws.png
---

## Overview of deployment options

Amazon Web Services (AWS), being the most popular cloud infrastructure provider, offers a huge range of services for hosting applications, varying in cost, level of abstraction and flexibility. We have evaluated different options for deploying the Electric sync service to it, including Elastic Beanstalk, LIghtsail, App Runner, Elastic Container Service (ECS) and Elastic Compute Cloud (EC2). Out of those, we have found ECS on AWS Fargate to provide the best middleground for its low maintenance requirements and easy setup while at the same time integrating with the core building blocks of AWS such as VPC, security groups and load balancers.

At a high level, ECS on AWS Fargate can be thought of as a managed, serverless hosting option for containerized apps that can be natively integrated with other building blocks of AWS deployments, including load balancers, managed databases, and so on.


## Amazon ECS on AWS Fargate

Amazon Elastic Container Service (ECS) is a fully managed container orchestration service that helps you deploy and manage containerized applications with little effort. AWS Fargate is a pay-as-you-go compute engine that is built into Amazon ECS and that lets you focus on building applications without managing servers.

When you run your tasks and services with the Fargate launch type, you package your application in containers, specify the CPU and memory requirements, define networking and IAM policies, and launch the application. Each Fargate task has its own isolation boundary and does not share the underlying kernel, CPU resources, memory resources, or elastic network interface with another task.

## Deploying ElectricSQL to Amazon ECS using Terraform

We have chosen Terraform to provide an easy onboarding into deploying Electric to Amazon ECS since it is arguably the most popular infrastructure provisioning tool. Its official provider for AWS covers all settings one might want to configure and is ideal for creating reproducible infrastructure-as-code setups.

We have published a collection of Terraform modules with predefined configuration for running Electric as a Fargate task on Amazon ECS. Those are accompanied by example deployments that showcase the use of those modules to build out a custom setup suitable to your specific needs and one that can integrate with other services you may already be running in AWS.

Clone the repo:

```shell
git clone https://github.com/electric-sql/terraform-aws
```

Follow the instructions in the [README.md](https://github.com/electric-sql/terraform-aws#readme). The examples include setting up an RDS for PostgreSQL instance and using an existing RDS instance. We also provide modules for provisioning a CloudFront distribution backed by an S3 bucket to let you upload your web application's assets and serve the app from the global CDN that is Amazon CloudFront.


