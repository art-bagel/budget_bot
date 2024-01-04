-- prod.users definition

-- Drop table

-- DROP TABLE prod.users;

CREATE TABLE prod.users (
	id int8 NOT NULL,
	username varchar(100) null, 
	first_name varchar(100) null, 
	last_name varchar(100) null,
	CONSTRAINT users_pkey PRIMARY KEY (id)
);