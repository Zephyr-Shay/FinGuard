#!/usr/bin/env python3
"""Verify the public leaf certificate actually loaded by both FinGuard listeners."""
import argparse,datetime,hashlib,json,pathlib,re,socket,ssl,time

def check(certificate,ip,ports,min_hours):
 pem=pathlib.Path(certificate).read_text(encoding='ascii')
 leaf=re.search(r'-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----',pem)
 if not leaf:raise RuntimeError('certificate file contains no leaf certificate')
 expected=ssl.PEM_cert_to_DER_cert(leaf.group());context=ssl.create_default_context();results=[]
 for port in ports:
  for attempt in range(12):
   with socket.create_connection(('127.0.0.1',port),timeout=5)as connection:
    with context.wrap_socket(connection,server_hostname=ip)as tls:info=tls.getpeercert();served=tls.getpeercert(binary_form=True)
   if served==expected:break
   if attempt==11:raise RuntimeError('served certificate does not match the current leaf certificate')
   time.sleep(.25)
  expiry=datetime.datetime.strptime(info['notAfter'],'%b %d %H:%M:%S %Y %Z').replace(tzinfo=datetime.timezone.utc)
  remaining=(expiry-datetime.datetime.now(datetime.timezone.utc)).total_seconds()/3600
  if remaining<min_hours:raise RuntimeError('certificate has less than the required remaining lifetime')
  results.append({'port':port,'expiresAt':expiry.isoformat(),'remainingHours':round(remaining,2),'sha256':hashlib.sha256(served).hexdigest(),'trustedAndHostVerified':True})
 return {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'certificateLoaded':True,'listeners':results}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--certificate',default='/opt/finguard-ip-access/letsencrypt/live/finguard-ip/fullchain.pem');parser.add_argument('--ip',default='193.112.26.177');parser.add_argument('--ports',nargs='+',type=int,default=[443,8443]);parser.add_argument('--min-hours',type=int,default=48);parser.add_argument('--status-file');args=parser.parse_args()
 result=check(args.certificate,args.ip,args.ports,args.min_hours)
 if args.status_file:
  target=pathlib.Path(args.status_file);temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');temporary.replace(target)
 print(json.dumps(result))
