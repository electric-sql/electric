LUX=./lux/bin/lux

lux:
	git clone https://github.com/hawk/lux.git
	cd lux && \
	autoconf && \
	./configure && \
	make

start_dev_env:
	docker-compose up -d

stop_dev_env:
	docker-compose down
	docker-compose stop

test: lux .pull
	${LUX} simple_test.lux

.pull: vaxine
	docker-compose pull
	docker-compose build
	touch .pull

vaxine:
	git clone https://github.com/vaxine-io/vaxine.git

clean:
	rm -rf lux
	rm -rf vaxine .pull

docker-attach-%:
	docker-compose exec $* bash
