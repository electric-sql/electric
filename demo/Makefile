LUX=./lux/bin/lux

lux:
	git clone https://github.com/hawk/lux.git
	cd lux && \
	autoconf && \
	./configure && \
	make

start_dev_env:
	docker-compose up -d db_a db_b db_c

start_vaxine:
	docker-compose up --no-color --no-log-prefix vaxine

start_electric:
	docker-compose up --no-color --no-log-prefix electric

start_electric_b:
	docker-compose up --no-color --no-log-prefix electric_b

stop_dev_env:
	docker-compose down
	docker-compose stop

test: lux .pull
	${LUX} *.lux

.pull: vaxine
	docker-compose pull db_a db_b
	touch .pull

vaxine:
	git clone https://github.com/vaxine-io/vaxine.git
	cd vaxine && make docker-build

docker-psql-%:
	docker exec -it -e PGPASSWORD=password demo_$*_1 psql -h $* -U electric -d electric

clean:
	rm -rf lux
	rm -rf vaxine .pull

docker-attach-%:
	docker-compose exec $* bash
