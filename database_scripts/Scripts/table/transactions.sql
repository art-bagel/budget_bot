-- prod.transactions definition

-- Drop table

-- DROP TABLE prod.transactions;

CREATE TABLE prod.transactions (
	id serial8 NOT NULL,
	user_id int8 NOT NULL,
	category_from int8 NOT NULL,
	category_to int8 NULL,
	"date" timestamp NOT NULL,
	amount numeric(10, 2) NOT NULL,
	description text NULL,
	CONSTRAINT transactions_pkey PRIMARY KEY (id)
);