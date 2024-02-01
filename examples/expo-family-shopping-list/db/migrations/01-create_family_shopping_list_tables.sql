
CREATE TABLE IF NOT EXISTS family (
    family_id UUID PRIMARY KEY,
    creator_user_id UUID NOT NULL,
    name VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    image_base_64 TEXT
);

CREATE TABLE IF NOT EXISTS member (
    member_id UUID PRIMARY KEY,
    family_id UUID NOT NULL
        REFERENCES family(family_id)
        ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    image_base_64 TEXT
);

CREATE TABLE IF NOT EXISTS shopping_list (
    list_id UUID PRIMARY KEY,
    family_id UUID NOT NULL
        REFERENCES family(family_id)
        ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS shopping_list_item (
    item_id UUID PRIMARY KEY,
    list_id UUID NOT NULL
        REFERENCES shopping_list(list_id)
        ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    name VARCHAR NOT NULL,
    quantity INTEGER NOT NULL,
    comment TEXT,
    image_base_64 TEXT,
    completed BOOLEAN NOT NULL
);


-- Function to assign every new user their own default family and membership
CREATE OR REPLACE FUNCTION create_family_and_member()
RETURNS TRIGGER AS $$
DECLARE
    new_user_name VARCHAR;
    new_family_id UUID;
    new_member_id UUID;
BEGIN
    -- Infer user's name from first part of email    
    new_user_name := SPLIT_PART(NEW.email, '@', 1);

    -- Generate new UUIDs for family and member
    new_family_id := uuid_generate_v4();
    new_member_id := uuid_generate_v4();

    -- Insert into family table
    INSERT INTO family (family_id, creator_user_id, name, created_at)
    VALUES (new_family_id, NEW.id, new_user_name || '''s Family', CURRENT_TIMESTAMP);

    -- Insert into member table
    INSERT INTO member (member_id, family_id, user_id, name, created_at)
    VALUES (new_member_id, new_family_id, NEW.id, new_user_name, CURRENT_TIMESTAMP);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function after a new user is created
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE create_family_and_member();


-- Electrify all relevant tables
ALTER TABLE family ENABLE ELECTRIC;
ALTER TABLE member ENABLE ELECTRIC;
ALTER TABLE shopping_list ENABLE ELECTRIC;
ALTER TABLE shopping_list_item ENABLE ELECTRIC;
