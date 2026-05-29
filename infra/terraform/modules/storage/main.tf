variable "vpc_id" { type = string }

resource "aws_efs_file_system" "lance" {
  encrypted = true
  tags = { Name = "clawmind-lancedb" }
}

output "efs_id" { value = aws_efs_file_system.lance.id }
