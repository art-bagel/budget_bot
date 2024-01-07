-- prod.category_groups definition

-- Drop table

-- DROP TABLE prod.category_groups;

CREATE TABLE prod.category_groups (
	id serial4 NOT NULL,
	user_id int8 NULL,
	group_id int8 NULL,
	category_id int8 NULL,
	"percent" numeric(4, 3) NULL,
	CONSTRAINT category_groups_pkey PRIMARY KEY (id, user_id)
);