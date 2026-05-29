output "cluster_name" { value = module.eks.cluster_name }
output "vpc_id"       { value = module.network.vpc_id }
output "efs_id"       { value = module.storage.efs_id }
