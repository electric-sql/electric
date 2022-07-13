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

.pull:
	docker-compose pull
	touch .pull

clean:
	rm -rf lux
