import sqlite3

def inspect_data():
    conn = sqlite3.connect('data/bantulex.db')
    cursor = conn.cursor()
    
    print("Reflex columns:")
    cursor.execute("PRAGMA table_info(reflex)")
    cols = cursor.fetchall()
    print([c[1] for c in cols])
    
    print("\nSample reflexes with morph analysis:")
    query = """
    SELECT r.id, r.term, r.term_morph_analysis, r.translation, b.word as blr_word
    FROM reflex r
    LEFT JOIN reconstruction b ON r.blr_entry_id = b.id
    WHERE r.term_morph_analysis IS NOT NULL 
    LIMIT 20
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    for row in rows:
        print(row)
    
    print("\nSample 'hidden' morphology (term is plain, analysis is segmented):")
    query_hidden = """
    SELECT r.id, r.term, r.term_morph_analysis, r.translation, b.word as blr_word, r.part_of_speech
    FROM reflex r
    JOIN reconstruction b ON r.blr_entry_id = b.id
    WHERE r.term_morph_analysis IS NOT NULL
      AND r.term NOT LIKE '%-%'
      AND r.term NOT LIKE '% %'
      AND (r.term_morph_analysis LIKE '%-%' OR r.term_morph_analysis LIKE '% %')
    LIMIT 20
    """
    cursor.execute(query_hidden)
    rows = cursor.fetchall()
    for row in rows:
        print(row)

    print("\nUnique POS tags:")
    cursor.execute("SELECT DISTINCT part_of_speech FROM reflex")
    pos_tags = [r[0] for r in cursor.fetchall()]
    print(pos_tags)

    print("\nCheck for gloss patterns in reflex that differ from BLR (potential semantic addition):")
    query_gloss = """
    SELECT r.term, r.translation, b.word as blr_word, b.english as blr_eng, b.french as blr_fr
    FROM reflex r
    JOIN reconstruction b ON r.blr_entry_id = b.id
    WHERE b.word IS NOT NULL
      AND (r.translation NOT LIKE '%' || b.english || '%' AND r.translation NOT LIKE '%' || b.french || '%')
    LIMIT 20
    """
    cursor.execute(query_gloss)
    rows = cursor.fetchall()
    for row in rows:
        print(row)

    conn.close()

if __name__ == "__main__":
    inspect_data()
