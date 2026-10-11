import csv, gzip, importlib.util, io, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-epi-report.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class ReportTest(unittest.TestCase):
    def test_quotes_repeated_rows_and_conflicts(self):
        stream=io.StringIO();writer=csv.writer(stream,delimiter=';');writer.writerow(builder.COLUMNS.values())
        row=['365','CAPACETE','FABRICANTE','MODELO','Descrição; "com aspas"\ne outra linha','01/01/2028','VÁLIDO']
        writer.writerow(row);writer.writerow(row);other=[*row];other[0]='123';writer.writerow(other);other[3]='DIVERGENTE';writer.writerow(other)
        data=('\ufeff\ufeff'+stream.getvalue()).encode();source=gzip.compress(data)+b'\r\n<html>ASP.NET</html>'
        extracted,_=builder.ca_builder.extract_gzip(source);records,count=builder.parse(extracted)
        self.assertEqual(count,4);self.assertEqual(len(records),2);self.assertTrue(records[0]['ambiguous']);self.assertEqual(len(records[0]['variants']),2)
        self.assertEqual(records[1]['descricao'],row[4]);self.assertNotIn('tamanho',records[1])
    def test_malformed_source_is_rejected(self):
        with self.assertRaises(ValueError):builder.parse(b'CA;Nome\n365;Capacete')
        with self.assertRaises(ValueError):builder.ca_builder.extract_gzip(gzip.compress(b'csv')+b'not html')
if __name__=='__main__':unittest.main()
