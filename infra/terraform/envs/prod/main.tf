module "clawmind" {
  source       = "../.."
  environment  = "prod"
  region       = "us-west-2"
  cluster_name = "clawmind-prod"
}
