start:
	docker compose up

start_without_electric:
	docker compose up postgres_1 vaxine_1 local_api

start_electric:
	docker compose up electric_1

stop:
	docker compose down --volumes

clean:
	docker volume rm -f local-stack_electric_data
	docker volume rm -f local-stack_pg_data
	docker volume rm -f local-stack_vaxine_data
	docker volume rm -f local-stack_migrations_volume

