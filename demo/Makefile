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

test: lux
	${LUX} simple_test.lux

clean:
	rm -rf lux
