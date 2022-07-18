LUX=./lux/bin/lux

lux:
	git clone https://github.com/hawk/lux.git
	cd lux && \
	autoconf && \
	./configure && \
	make

start_dev_env:
	docker-compose up -d vaxine db_a db_b

start_electric:
	docker-compose up electric

stop_dev_env:
	docker-compose down
	docker-compose stop

test: lux .pull
	${LUX} simple_test.lux

.pull: vaxine
	docker-compose pull db_a db_b
	touch .pull

vaxine:
	git clone https://github.com/vaxine-io/vaxine.git
	cd vaxine && make docker-build

clean:
	rm -rf lux
	rm -rf vaxine .pull

docker-attach-%:
	docker-compose exec $* bash
