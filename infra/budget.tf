##############################################################################
# ⚠  REFERENCE ONLY — DO NOT APPLY THIS FILE BLINDLY
# AI-generated starting point, NOT production-ready and NOT reviewed.
# Applying it to an existing stack can DESTROY OR LOSE DATA, and it will need
# changes to fit your infrastructure. Even for a greenfield project: read it,
# run `terraform plan`, set a billing budget — you own every resource it creates.
##############################################################################

# =============================================================================
# REFERENCE-ONLY Terraform for the BUDGET tier — generated
# DETERMINISTICALLY from the design graph. Human review + hardening required.
# =============================================================================

# =============================================================================
# PROVIDERS & VARIABLES
# =============================================================================

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certs and WAF web ACLs for CloudFront MUST live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "ami_id" {
  type        = string
  description = "Machine image for the application box (Amazon Linux 2023 recommended)."
}

variable "domain_name" {
  type        = string
  description = "Primary domain served by CloudFront, e.g. example.com."
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted-zone id for domain_name (ACM DNS validation + alias records)."
}

# A CloudFront https-only origin must present a trusted-CA cert for its hostname.
# NEVER an EC2 instance public DNS / raw ALB DNS name (no cert, churns on replace)
# — supply a custom domain (ALB or EIP + Route53) with an ACM cert. (rule:
# cloudfront-origin-tls)
variable "origin_domain" {
  type        = string
  description = "Custom domain (ALB / EIP + Route53) for the dynamic origin — MUST have a TLS cert."
}

variable "ops_email" {
  type        = string
  description = "Destination for SNS ops alerts."
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = var.aws_region
}

# =============================================================================
# NETWORKING
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "budget-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "budget-igw" }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.0.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags                    = { Name = "budget-public-a" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "budget-public-rt" }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# =============================================================================
# IAM
# =============================================================================

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# =============================================================================
# IAM — WEB + ORCHESTRATOR HOST
# =============================================================================

resource "aws_iam_role" "ec2_box" {
  name               = "budget-ec2-box-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ec2_box_managed" {
  role       = aws_iam_role.ec2_box.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_box_inline" {
  name = "budget-ec2-box-inline"
  role = aws_iam_role.ec2_box.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3_s3_assets"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.s3_assets.arn,
          "${aws_s3_bucket.s3_assets.arn}/*"
        ]
      },
      {
        Sid      = "Secret_secrets"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.secrets.arn
      },
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/budget/*"
      },
      {
        Sid      = "Route53ACMEChange"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = "arn:${local.partition}:route53:::hostedzone/${var.route53_zone_id}"
      },
      {
        Sid    = "Route53ACMERead"
        Effect = "Allow"
        Action = [
          "route53:ListResourceRecordSets",
          "route53:GetChange"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_box" {
  name = "budget-ec2-box-profile"
  role = aws_iam_role.ec2_box.name
}

# =============================================================================
# SECURITY GROUP — WEB + ORCHESTRATOR HOST
# =============================================================================

resource "aws_security_group" "ec2_box" {
  name        = "budget-ec2-box-sg"
  description = "Ingress for web + orchestrator host; egress to AWS services"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTPS from CloudFront only"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  ingress {
    description     = "HTTP from CloudFront only (redirect)"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "budget-ec2-box-sg" }
}

# =============================================================================
# EC2 — WEB + ORCHESTRATOR HOST
# =============================================================================

resource "aws_instance" "ec2_box" {
  ami                    = var.ami_id
  instance_type          = "t4g.medium"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2_box.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_box.name

  # IMDSv2 required (no v1 fallback).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = { Name = "budget-ec2-box" }
}

# =============================================================================
# ORIGIN ADDRESS + DNS (CloudFront https-only origin)
# =============================================================================

resource "aws_eip" "ec2_box" {
  domain   = "vpc"
  instance = aws_instance.ec2_box.id
  tags     = { Name = "budget-ec2-box-eip" }
}

# origin.<domain> → the box; CloudFront's origin_domain points here and Caddy
# terminates TLS with a Let's Encrypt cert for this exact hostname.
resource "aws_route53_record" "origin" {
  zone_id = var.route53_zone_id
  name    = var.origin_domain
  type    = "A"
  ttl     = 60
  records = [aws_eip.ec2_box.public_ip]
}

# =============================================================================
# SELF-MANAGED POSTGRESQL — PRIMARY DB (LOCALHOST)
# =============================================================================

# Self-managed Postgres rides on the EC2 box (localhost-bound, not network-
# exposed). Its data lives on a dedicated KMS-encrypted gp3 EBS volume.
resource "aws_ebs_volume" "postgres" {
  availability_zone = "us-east-1a"
  size              = 50
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "budget-postgres" }
}

resource "aws_volume_attachment" "postgres" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.postgres.id
  instance_id = aws_instance.ec2_box.id
}

# =============================================================================
# S3 — DB BACKUP STORE
# =============================================================================

resource "aws_s3_bucket" "s3_backups" {
  bucket_prefix = "budget-s3-backups-"
  force_destroy = false
}

resource "aws_s3_bucket_server_side_encryption_configuration" "s3_backups" {
  bucket = aws_s3_bucket.s3_backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "s3_backups" {
  bucket                  = aws_s3_bucket.s3_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "s3_backups" {
  bucket = aws_s3_bucket.s3_backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_policy" "s3_backups" {
  bucket = aws_s3_bucket.s3_backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.s3_backups.arn,
          "${aws_s3_bucket.s3_backups.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# =============================================================================
# S3 — ISR ASSETS + MEDIA STORE
# =============================================================================

resource "aws_s3_bucket" "s3_assets" {
  bucket_prefix = "budget-s3-assets-"
  force_destroy = false
}

resource "aws_s3_bucket_server_side_encryption_configuration" "s3_assets" {
  bucket = aws_s3_bucket.s3_assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "s3_assets" {
  bucket                  = aws_s3_bucket.s3_assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "s3_assets" {
  bucket = aws_s3_bucket.s3_assets.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_policy" "s3_assets" {
  bucket = aws_s3_bucket.s3_assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.s3_assets.arn,
          "${aws_s3_bucket.s3_assets.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# =============================================================================
# SECRETS MANAGER — CREDENTIALS STORE
# =============================================================================

# No automatic rotation is configured; the aws_secretsmanager_secret_rotation
# resource is intentionally OMITTED (rule: secretsmanager-rotation-enabled).
resource "aws_secretsmanager_secret" "secrets" {
  name = "budget/secrets"
}

resource "aws_secretsmanager_secret_version" "secrets" {
  secret_id = aws_secretsmanager_secret.secrets.id
  secret_string = jsonencode({
    username = "REPLACE_ME"
    password = "REPLACE_ME" # inject out-of-band; do not commit a real secret
  })
}

# =============================================================================
# SNS — OPS ALERT TOPIC
# =============================================================================

resource "aws_sns_topic" "sns_alerts" {
  name              = "budget-sns-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_policy" "sns_alerts" {
  arn = aws_sns_topic.sns_alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowAccountPublish"
        Effect = "Allow"
        Principal = {
          AWS = "arn:${local.partition}:iam::${local.account_id}:root"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.sns_alerts.arn
      },
      {
        Sid    = "AllowCloudWatchAlarms"
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.sns_alerts.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = local.account_id
          }
        }
      },
      {
        Sid       = "DenyNonTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.sns_alerts.arn
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "sns_alerts_email" {
  topic_arn = aws_sns_topic.sns_alerts.arn
  protocol  = "email"
  endpoint  = var.ops_email
}

# =============================================================================
# CLOUDWATCH LOGS
# =============================================================================

resource "aws_cloudwatch_log_group" "cw_logs" {
  name              = "/budget/app"
  retention_in_days = 30
  # at-rest via the AWS-managed CloudWatch Logs key (budget floor; a customer CMK is the balanced+ step-up)
}

# =============================================================================
# CLOUDWATCH ALARMS
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "ec2_box_cpu_high" {
  alarm_name          = "budget-ec2-box-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.sns_alerts.arn]
  ok_actions          = [aws_sns_topic.sns_alerts.arn]
  dimensions          = { InstanceId = aws_instance.ec2_box.id }
}

# =============================================================================
# WAF — CLOUDFRONT EDGE
# =============================================================================

# Edge web ACL: AWS managed baseline rules + a per-IP rate limit (anti-scrape).
resource "aws_wafv2_web_acl" "cf" {
  provider = aws.us_east_1
  name     = "budget-cf-waf"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSet"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "budget-cf-waf"
    sampled_requests_enabled   = true
  }
}

# =============================================================================
# CLOUDFRONT
# =============================================================================

resource "aws_acm_certificate" "cf" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cf_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cf.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  allow_overwrite = true
  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
}

resource "aws_acm_certificate_validation" "cf" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cf.arn
  validation_record_fqdns = [for r in aws_route53_record.cf_cert_validation : r.fqdn]
}

data "aws_canonical_user_id" "current" {}
data "aws_cloudfront_log_delivery_canonical_user_id" "current" {}

resource "aws_s3_bucket" "cf_logs" {
  bucket_prefix = "budget-cf-logs-"
  force_destroy = false
}

resource "aws_s3_bucket_ownership_controls" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id
  rule { object_ownership = "BucketOwnerPreferred" }
}

resource "aws_s3_bucket_public_access_block" "cf_logs" {
  bucket                  = aws_s3_bucket.cf_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront delivers access logs as the awslogsdelivery CanonicalUser; grant it
# FULL_CONTROL or logging silently no-ops under Block Public Access.
resource "aws_s3_bucket_acl" "cf_logs" {
  depends_on = [aws_s3_bucket_ownership_controls.cf_logs]
  bucket     = aws_s3_bucket.cf_logs.id
  access_control_policy {
    owner { id = data.aws_canonical_user_id.current.id }
    grant {
      grantee {
        id   = data.aws_cloudfront_log_delivery_canonical_user_id.current.id
        type = "CanonicalUser"
      }
      permission = "FULL_CONTROL"
    }
    grant {
      grantee {
        id   = data.aws_canonical_user_id.current.id
        type = "CanonicalUser"
      }
      permission = "FULL_CONTROL"
    }
  }
}

resource "aws_cloudfront_distribution" "cf" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  web_acl_id          = aws_wafv2_web_acl.cf.arn
  aliases             = [var.domain_name]

  # EC2 origin over a custom domain with a TLS cert (NOT a raw AWS DNS name — rule cloudfront-origin-tls).
  origin {
    domain_name = var.origin_domain
    origin_id   = "origin-ec2_box"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "origin-ec2_box"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    forwarded_values {
      query_string = true
      cookies { forward = "all" }
    }
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "origin-ec2_box"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 86400
    default_ttl = 604800
    max_ttl     = 31536000
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cf.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  logging_config {
    bucket          = aws_s3_bucket.cf_logs.bucket_domain_name
    prefix          = "cf-logs/"
    include_cookies = false
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
}

resource "aws_route53_record" "cf_alias" {
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.cf.domain_name
    zone_id                = aws_cloudfront_distribution.cf.hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# CLOUDTRAIL
# =============================================================================

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket_prefix = "budget-cloudtrail-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket                  = aws_s3_bucket.cloudtrail_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.cloudtrail_logs.arn
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/${local.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/aws/cloudtrail/budget"
  retention_in_days = 90
  # at-rest via the AWS-managed CloudWatch Logs key (budget floor; a customer CMK is the balanced+ step-up)
}

data "aws_iam_policy_document" "cloudtrail_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudtrail_cw" {
  name               = "budget-cloudtrail-cw"
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_assume.json
}

resource "aws_iam_role_policy" "cloudtrail_cw" {
  name = "cloudtrail-cw"
  role = aws_iam_role.cloudtrail_cw.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
      }
    ]
  })
}

resource "aws_cloudtrail" "cloudtrail" {
  name                          = "budget-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.bucket
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  include_global_service_events = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail_cw.arn
  depends_on                    = [aws_s3_bucket_policy.cloudtrail_logs]
}

# =============================================================================
# NOTES
# =============================================================================

# X-Ray removed: tracing buys ~nothing for a single-box + one-Lambda topology and
# needs app-side SDK wiring to emit anything — CloudWatch logs cover this tier.
# KMS CMKs omitted: S3/EBS/Secrets use AES256 / AWS-managed keys (budget floor).
# CloudTrail kept (single-region): the first management-events trail is free and
# is the only forensic record if the account is ever compromised. Ideally it
# lives in a separate account-level stack so a `terraform destroy` here can't
# nuke the audit trail — a v2 cleanup, not a go-live blocker.
