variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Name used for AWS resource tags."
  type        = string
  default     = "fitlook"
}

variable "environment" {
  description = "Environment name used for AWS resource tags."
  type        = string
  default     = "production"
}

variable "key_name" {
  description = "Existing EC2 key pair name for SSH access."
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH into the instances. Use your IP with /32."
  type        = string
}

variable "subnet_id" {
  description = "Optional subnet ID. Defaults to the first subnet in the default VPC."
  type        = string
  default     = ""
}

variable "repo_url" {
  description = "Git URL for the FitLook repository. EC2 instances must be able to clone it."
  type        = string
}

variable "repo_branch" {
  description = "Git branch to deploy."
  type        = string
  default     = "main"
}

variable "backend_env" {
  description = "Environment variables written to /etc/fitlook/backend.env on the backend instance."
  type        = map(string)
  sensitive   = true
  default     = {}
}
