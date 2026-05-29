variable "cidr_block"  { type = string }
variable "environment" { type = string }

resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  tags = { Name = "clawmind-${var.environment}" }
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.cidr_block, 4, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { "kubernetes.io/role/internal-elb" = "1" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.cidr_block, 4, count.index + 8)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { "kubernetes.io/role/elb" = "1" }
}

resource "aws_internet_gateway" "igw" { vpc_id = aws_vpc.main.id }

output "vpc_id"          { value = aws_vpc.main.id }
output "private_subnets" { value = aws_subnet.private[*].id }
output "public_subnets"  { value = aws_subnet.public[*].id }
