module "clawmind" {
  source       = "../.."
  environment  = "dev"
  region       = "us-west-2"
  cluster_name = "clawmind-dev"
}
