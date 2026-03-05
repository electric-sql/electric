#!/usr/bin/env bash
#
# Simulate AWS Fargate EBS I/O characteristics using dm-delay for latency
# and cgroup v2 throttling for IOPS/throughput limits.
#
# Creates a loop-backed device with dm-delay to simulate EBS latency (~2ms),
# then applies IOPS limits based on the Fargate on-demand performance tiers:
# https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-fargate-performance-limits.html
#
#   vCPUs | IOPS (16 KiB I/O) | Throughput (128 KiB I/O)
#   ------+--------------------+-------------------------
#       2 |             3,000  |    75 MiB/s
#       4 |             5,000  |   120 MiB/s
#       8 |            10,000  |   250 MiB/s
#      16 |            15,000  |   500 MiB/s
#
set -euo pipefail

usage() {
  echo "Usage: $0 --vcpus <2|4|8|16> [--size <size_mb>] [--latency <latency_ms>] [--backing-dir <path>]"
  echo
  echo "Simulate AWS Fargate EBS volume with realistic latency and IOPS limits."
  echo "Drops into a shell with DATA_DIR set to the simulated volume mount point."
  echo
  echo "Options:"
  echo "  --vcpus        Number of vCPUs (2, 4, 8, or 16)"
  echo "  --size         Size of the simulated volume in MB (default: 2048)"
  echo "  --latency      I/O latency in milliseconds (default: 2)"
  echo "  --backing-dir  Directory for the backing file (default: /tmp)"
  echo
  echo "Requires sudo access for dm-delay setup."
  exit 1
}

vcpus=""
size_mb=2048
latency_ms=2
backing_dir="/tmp"

while [[ $# -gt 0 ]]; do
  case "$1" in
  --vcpus)
    vcpus="$2"
    shift 2
    ;;
  --size)
    size_mb="$2"
    shift 2
    ;;
  --latency)
    latency_ms="$2"
    shift 2
    ;;
  --backing-dir)
    backing_dir="$2"
    shift 2
    ;;
  -h | --help) usage ;;
  *) usage ;;
  esac
done

if [[ -z "$vcpus" ]]; then
  usage
fi

case "$vcpus" in
2)
  iops=3000
  bps=78643200
  ;; # 75 MiB/s
4)
  iops=5000
  bps=125829120
  ;; # 120 MiB/s
8)
  iops=10000
  bps=262144000
  ;; # 250 MiB/s
16)
  iops=15000
  bps=524288000
  ;; # 500 MiB/s
*)
  echo "Error: --vcpus must be 2, 4, 8, or 16"
  exit 1
  ;;
esac

# Validate backing directory exists
if [[ ! -d "$backing_dir" ]]; then
  echo "Error: Backing directory does not exist: $backing_dir"
  exit 1
fi

# Generate unique names for this instance
instance_id="fargate_sim_$$-${vcpus}vcpu-${latency_ms}ms"
backing_file="${backing_dir}/${instance_id}.img"
dm_name="${instance_id}"
mount_point="/tmp/${instance_id}_mnt"
loop_dev=""

cleanup() {
  set +e
  echo
  echo "Cleaning up..."

  if mountpoint -q "$mount_point" 2>/dev/null; then
    sudo umount "$mount_point"
    echo "  Unmounted $mount_point"
  fi

  if [[ -e "/dev/mapper/$dm_name" ]]; then
    sudo dmsetup remove "$dm_name"
    echo "  Removed dm-delay device"
  fi

  if [[ -n "$loop_dev" && -b "$loop_dev" ]]; then
    sudo losetup -d "$loop_dev"
    echo "  Detached loop device $loop_dev"
  fi

  if [[ -f "$backing_file" ]]; then
    rm -f "$backing_file"
    echo "  Removed backing file"
  fi

  if [[ -d "$mount_point" ]]; then
    rmdir "$mount_point"
    echo "  Removed mount point"
  fi

  echo "Cleanup complete."
}

trap cleanup EXIT

echo "Fargate EBS I/O Simulation"
echo "=========================="
echo "  vCPUs:      $vcpus"
echo "  IOPS:       $iops (read + write)"
echo "  Throughput: $((bps / 1048576)) MiB/s (read + write)"
echo "  Latency:    ${latency_ms}ms (read + write)"
echo "  Size:       ${size_mb} MB"
echo "  Backing:    $backing_file"
echo

# Create backing file
echo "Creating ${size_mb}MB backing file..."
dd if=/dev/zero of="$backing_file" bs=1M count="$size_mb" status=progress

# Set up loop device
echo "Setting up loop device..."
loop_dev=$(sudo losetup --find --show "$backing_file")
echo "  Loop device: $loop_dev"

# Get device size in 512-byte sectors
dev_sectors=$(sudo blockdev --getsz "$loop_dev")

# Create dm-delay device
echo "Creating dm-delay device with ${latency_ms}ms latency..."
sudo dmsetup create "$dm_name" --table "0 $dev_sectors delay $loop_dev 0 $latency_ms $loop_dev 0 $latency_ms"
dm_dev="/dev/mapper/$dm_name"
echo "  DM device: $dm_dev"

# Format the device:
#   -m 0: no reserved blocks (simulating a data volume)
#   -i 4096: more inodes (1 per 4KB instead of default 16KB) for many small files
#   -O large_dir: support for directories with millions of entries
echo "Formatting as ext4..."
sudo mkfs.ext4 -q -m 0 -i 4096 -O large_dir "$dm_dev"

# Mount the device
mkdir -p "$mount_point"
sudo mount "$dm_dev" "$mount_point"
sudo chown "$(id -u):$(id -g)" "$mount_point"
echo "  Mounted at: $mount_point"

# Verify the mount is working
if ! df -h "$mount_point" | grep -q "$dm_name"; then
  echo "Error: Mount verification failed"
  exit 1
fi
echo "  Available: $(df -h "$mount_point" | tail -1 | awk '{print $4}')"
echo "  Inodes:    $(df -i "$mount_point" | tail -1 | awk '{print $4 " free (" $5 " used)"}')"

echo
echo "Starting shell with I/O limits applied..."
echo "  DATA_DIR=$mount_point"
echo "  Exit the shell to clean up."
echo

# Run shell with cgroup I/O limits
export DATA_DIR="$mount_point"
systemd-run --scope --user \
  --same-dir \
  -p IOReadIOPSMax="$dm_dev $iops" \
  -p IOWriteIOPSMax="$dm_dev $iops" \
  -p IOReadBandwidthMax="$dm_dev $bps" \
  -p IOWriteBandwidthMax="$dm_dev $bps" \
  -p AllowedCPUs="0-$((${vcpus} - 1))" \
  --setenv=DATA_DIR="$mount_point" \
  -- "${SHELL:-/bin/bash}"
