-- prod.category_user definition

-- Drop table

-- DROP TABLE prod.category_user;

CREATE TABLE prod.category_user (
	id bigserial NOT NULL,
	category_id int8 NOT NULL,
	user_id int8 NOT NULL,
	is_owner bool NOT NULL,
	CONSTRAINT category_user_pkey PRIMARY KEY (id)
);