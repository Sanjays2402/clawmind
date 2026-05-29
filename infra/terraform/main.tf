provider "aws" {
  region = var.region
  default_tags { tags = { app = "clawmind", env = var.environment } }
}

module "network" {
  source       = "./modules/network"
  cidr_block   = var.vpc_cidr
  environment  = var.environment
}

module "eks" {
  source        = "./modules/eks"
  cluster_name  = var.cluster_name
  vpc_id        = module.network.vpc_id
  subnet_ids    = module.network.private_subnets
}

module "storage" {
  source = "./modules/storage"
  vpc_id = module.network.vpc_id
}
