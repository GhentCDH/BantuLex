import pandas as pd
try:
    df = pd.read_excel('data/bantulex.xlsx')
    print("Headers:", list(df.columns))
except Exception as e:
    print("Error:", e)
