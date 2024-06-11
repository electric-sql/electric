#!/bin/bash

num_users=(100 1000 10000 100000)
num_projects=(100 1000 10000 100000)
num_members=(100 1000 10000 10000)
num_tasks=(1000 10000 10000 10000)

set -e

for i in ${!num_users[@]}; do
	NUM_USERS=${num_users[$i]} \
	NUM_PROJECTS=${num_projects[$i]} \
	NUM_MEMBERS=${num_members[$i]} \
	NUM_TASKS=${num_tasks[$i]} \
  LOG_LEVEL=info \
  ${LUX} --junit load-testing/07.02_initial_sync_to_node_satellite.lux
done
