include common.mk

deps: lux
	make -C satellite_client build
	make -C elixir_client build

test_only: test_1 test_2 test_3 test_4 test_5

test_1:
	${LUX} --junit tests/01.*

test_2:
	${LUX} --junit tests/02.*

test_3:
	${LUX} --junit tests/03.*

test_4:
	${LUX} --junit tests/04.*

test_5:
	${LUX} --junit tests/05.*

test: deps pull test_only

pull:
	docker compose -f services_templates.yaml pull \
		postgresql

stop:
	make -C tests stop_dev_env

clean:
	rm -rf lux
	rm -rf postgres
