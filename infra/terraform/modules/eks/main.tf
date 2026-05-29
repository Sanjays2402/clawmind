variable "cluster_name" { type = string }
variable "vpc_id"       { type = string }
variable "subnet_ids"   { type = list(string) }

resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "eks.amazonaws.com" },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn
  vpc_config { subnet_ids = var.subnet_ids }
  depends_on = [aws_iam_role_policy_attachment.cluster]
}

output "cluster_name" { value = aws_eks_cluster.this.name }
output "endpoint"     { value = aws_eks_cluster.this.endpoint }
