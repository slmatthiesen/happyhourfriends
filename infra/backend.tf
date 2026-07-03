terraform {
  backend "s3" {
    key     = "budget/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
    # bucket and dynamodb_table supplied via -backend-config at init time.
  }
}
