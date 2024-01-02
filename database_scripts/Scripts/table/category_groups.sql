-- prod.category_groups definition

-- Drop table

-- DROP TABLE prod.category_groups;

CREATE TABLE prod.category_groups (
	id serial4 NOT NULL,
	group_name int4 NULL,
	CONSTRAINT category_groups_pkey PRIMARY KEY (id)
);