-- prod.categories definition

-- Drop table

-- DROP TABLE prod.categories;

CREATE TABLE prod.categories (
	id bigserial NOT NULL,
	"name" varchar(100) NOT NULL,
	user_id int8 NOT NULL,
	is_income bool NOT NULL,
	date_from timestamp NOT NULL,
	date_to timestamp NOT NULL,
	is_activ bool NOT NULL,
	is_group bool NOT NULL,
	CONSTRAINT categories_pkey PRIMARY KEY (id, user_id)
);