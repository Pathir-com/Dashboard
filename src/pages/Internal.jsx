import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Building2, Plus, Pencil, Trash2, Lock, Loader2, LogOut, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const ADMIN_PASSWORD = "E0+2HK'~3:r";
const ADMIN_EMAIL = "admin2025@pathir.com";

const createSlug = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

export default function Internal() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPractice, setEditingPractice] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    chatbase_agent_id: '',
    elevenlabs_agent_id: ''
  });

  useEffect(() => {
    const authStatus = sessionStorage.getItem('practiceManagementAuth');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const queryClient = useQueryClient();

  const { data: practices = [] } = useQuery({
    queryKey: ['practices'],
    queryFn: () => base44.entities.Practice.list('-created_date')
  });

  const { data: enquiries = [] } = useQuery({
    queryKey: ['all-enquiries'],
    queryFn: () => base44.entities.Enquiry.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Practice.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success('Practice created successfully');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Practice.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success('Practice updated successfully');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Practice.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      toast.success('Practice deleted');
    }
  });

  const resetForm = () => {
    setFormData({ name: '', password: '', chatbase_agent_id: '', elevenlabs_agent_id: '' });
    setEditingPractice(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingPractice) {
      updateMutation.mutate({ id: editingPractice.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (practice) => {
    setEditingPractice(practice);
    setFormData({
      name: practice.name,
      password: practice.password,
      chatbase_agent_id: practice.chatbase_agent_id || '',
      elevenlabs_agent_id: practice.elevenlabs_agent_id || ''
    });
    setIsDialogOpen(true);
  };

  const getEnquiryCount = (practiceId) => {
    return enquiries.filter(e => e.practice_id === practiceId).length;
  };

  const getClinicUrl = (practice) => {
    return `${window.location.origin}${createPageUrl('Clinic')}?id=${practice.id}`;
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (passwordInput.trim() === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem('practiceManagementAuth', 'true');
      setPasswordInput('');
      setPasswordError('');
      setShowResetForm(false);
      setResetEmail('');
      setEnteredCode('');
      setResetCode('');
      setShowCodeInput(false);
      toast.success('Access granted');
    } else {
      setPasswordError('Incorrect password. Please try again.');
      toast.error('Incorrect password');
      setPasswordInput('');
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (resetEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      toast.error('Email not recognized');
      return;
    }

    setIsSendingReset(true);
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setResetCode(code);

      await base44.integrations.Core.SendEmail({
        to: ADMIN_EMAIL,
        subject: 'Practice Management Password Reset Code',
        body: `Your password reset code is: ${code}\n\nThis code will expire in 15 minutes.\n\nEnter this code on the login page to reset your password.\n\nIf you did not request this, please ignore this email.`
      });
      
      setResetSent(true);
      setShowCodeInput(true);
      toast.success('Reset code sent to your email');
    } catch (error) {
      toast.error('Failed to send reset email');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleCodeVerification = (e) => {
    e.preventDefault();
    if (enteredCode === resetCode) {
      toast.success('Code verified! Your password is: ' + ADMIN_PASSWORD, { duration: 10000 });
      setShowResetForm(false);
      setResetSent(false);
      setShowCodeInput(false);
      setResetEmail('');
      setEnteredCode('');
      setResetCode('');
    } else {
      toast.error('Invalid code. Please try again.');
    }
  };

  const { logout: supabaseLogout, user: authUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem('practiceManagementAuth');
    await supabaseLogout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md" style={{
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
          <CardHeader>
            <div className="text-center">
              <Lock className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <CardTitle className="text-2xl">Practice Management</CardTitle>
              <p className="text-slate-500 mt-2">Enter admin password to continue</p>
            </div>
          </CardHeader>
          <CardContent>
            {!showResetForm ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="Enter password"
                    autoFocus
                    required
                  />
                  {passwordError && (
                    <p className="text-sm text-red-600 mt-1">{passwordError}</p>
                  )}
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
                  Login
                </Button>
                <button
                  type="button"
                  onClick={() => setShowResetForm(true)}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 underline"
                >
                  Forgot password?
                </button>
              </form>
            ) : showCodeInput ? (
              <form onSubmit={handleCodeVerification} className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-emerald-800">
                    ✓ Reset code sent to {resetEmail}
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">
                    Check your email and enter the 6-digit code below
                  </p>
                </div>
                <div>
                  <Label>Reset Code</Label>
                  <Input
                    type="text"
                    value={enteredCode}
                    onChange={(e) => setEnteredCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    autoFocus
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
                  Verify Code
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowResetForm(false);
                    setShowCodeInput(false);
                    setResetSent(false);
                    setResetEmail('');
                    setEnteredCode('');
                  }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 underline"
                >
                  Back to login
                </button>
              </form>
            ) : (
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div>
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoFocus
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={isSendingReset}
                >
                  {isSendingReset ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Code'
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowResetForm(false)}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 underline"
                >
                  Back to login
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Practice Management</h1>
            <p className="text-slate-500 mt-2">
              {authUser?.email ? `Signed in as ${authUser.email}` : 'Manage all dental practices'}
            </p>
          </div>
          
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Practice
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingPractice ? 'Edit Practice' : 'New Practice'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                  <div>
                    <Label>Practice Name</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="e.g., Dental Care Clinic"
                      required
                    />
                  </div>
                  <div>
                    <Label>Dashboard Password</Label>
                    <Input
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      placeholder="Enter password"
                      type="text"
                      required
                    />
                  </div>
                  <div>
                    <Label>Website Chat Agent ID</Label>
                    <Input
                      value={formData.chatbase_agent_id}
                      onChange={(e) => setFormData({...formData, chatbase_agent_id: e.target.value})}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <Label>Phone Agent ID</Label>
                    <Input
                      value={formData.elevenlabs_agent_id}
                      onChange={(e) => setFormData({...formData, elevenlabs_agent_id: e.target.value})}
                      placeholder="Optional"
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    {editingPractice ? 'Update Practice' : 'Create Practice'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {practices.map((practice) => (
            <Card key={practice.id} style={{
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  {practice.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm space-y-3">
                  <div className="space-y-1.5">
                    <span className="text-slate-500 text-xs font-medium">Dashboard URL:</span>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-blue-50 text-blue-700 px-2 py-1.5 rounded border border-blue-200 break-all">
                        {getClinicUrl(practice)}
                      </code>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => copyToClipboard(getClinicUrl(practice), 'URL')}
                        className="flex-shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-slate-500 text-xs font-medium">Password:</span>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono bg-slate-100 px-2 py-1.5 rounded text-xs break-all">
                        {practice.password}
                      </code>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => copyToClipboard(practice.password, 'Password')}
                        className="flex-shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500">Enquiries:</span>
                    <span className="ml-2 font-semibold">{getEnquiryCount(practice.id)}</span>
                  </div>
                  {practice.chatbase_agent_id && (
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-500">Website Chat:</span>
                      <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded break-all">{practice.chatbase_agent_id}</span>
                    </div>
                  )}
                  {practice.elevenlabs_agent_id && (
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-500">Phone:</span>
                      <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded break-all">{practice.elevenlabs_agent_id}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Link to={`/Clinic?id=${practice.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <ExternalLink className="w-4 h-4 mr-1" />
                      Open
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={() => handleEdit(practice)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      if (confirm('Delete this practice?')) {
                        deleteMutation.mutate(practice.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {practices.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Building2 className="w-12 h-12 mx-auto mb-4 stroke-1" />
            <p>No practices yet. Add your first practice to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}