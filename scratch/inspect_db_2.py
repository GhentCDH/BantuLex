import sqlite3

def inspect_data():
    conn = sqlite3.connect('data/bantulex.db')
    cursor = conn.cursor()
    
    print("\n'Hidden' morphology cases (term plain, analysis segmented):")
    query_hidden = """
    SELECT r.id, r.term, r.term_morph_analysis, r.translation, b.word as blr_word, r.part_of_speech
    FROM reflex r
    JOIN reconstruction b ON r.blr_entry_id = b.id
    WHERE r.term_morph_analysis IS NOT NULL
      AND r.term NOT LIKE '%-%'
      AND r.term NOT LIKE '% %'
      AND (r.term_morph_analysis LIKE '%-%' OR r.term_morph_analysis LIKE '% %')
    LIMIT 50
    """
    cursor.execute(query_hidden)
    rows = cursor.fetchall()
    for row in rows:
        print(row)

    print("\nCases where POS might indicate a derivation (e.g. 'v. deriv.'):")
    query_deriv = """
    SELECT r.term, r.term_morph_analysis, r.translation, r.part_of_speech
    FROM reflex r
    WHERE r.part_of_speech LIKE '%deriv%' OR r.part_of_speech LIKE '%ext%'
    LIMIT 20
    """
    cursor.execute(query_deriv)
    rows = cursor.fetchall()
    for row in rows:
        print(row)

    print("\nCheck meanings for addition relative to BLR glosses:")
    # Look for cases where the reflex translation is much longer than the BLR english/french
    query_long_gloss = """
    SELECT r.term, r.translation, b.english, b.french
    FROM reflex r
    JOIN reconstruction b ON r.blr_entry_id = b.id
    WHERE length(r.translation) > length(b.english) + 20
      AND b.english IS NOT NULL
    LIMIT 20
    """
    cursor.execute(query_long_gloss)
    rows = cursor.fetchall()
    for row in rows:
        print(row)

    conn.close()

if __name__ == "__main__":
    inspect_data()
