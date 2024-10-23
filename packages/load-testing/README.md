# Electric load testing

A collection of load-testing scripts for Electric written using [Locust](https://github.com/locustio/locust).

# Requirements
- Python 3
- Locust

# Local installation guide
We're using [asdf](https://asdf-vm.com/) to install Python. Versions are defined in .tool-versions.

```bash
brew install asdf
asdf plugin-add python
asdf install
```

Create a virtual env and activate it
```bash
python -m venv .venv
source .venv/bin/activate
```

Install Locust
```bash
pip3 install locust
```

You're ready! 
Here is an example command to generate some load against Electric.
```
locust -H http://localhost:3000 -f tasks/long-polling.py -u 1000 -r 10 --processes -1  --autostart
```

- `-H` is the endpoint you want to access Electric from
- `-f` is the file with the tasks for the workload
- `-u` is the maximum number of concurrent user for the run
- `-r` is the rate at which new users are spawned
- `--processes` set -1 to create a worker per CPU thread
- `--autostart` automatically starts the load generation

You can access the web interface in ```http://localhost:8089```

# Docker
We provide a docker file that build an image with Locust and the tasks file, so you can run it from Cloud in distributed mode.


# Running in Google Cloud
Check this [guide](https://cloud.google.com/architecture/distributed-load-testing-using-gke) to learn how to run Locusts with Kubernetes.

We provide the deployments for Master and Worker Pods based on the same files used in that guide.






